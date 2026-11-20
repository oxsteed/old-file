const express = require('express');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const requireEmailVerified = require('../middleware/requireEmailVerified');
const requireTermsAcceptance = require('../middleware/requireTermsAcceptance');
const bookingController = require('../controllers/bookingController');
const bookingRecipientController = require('../controllers/bookingRecipientController');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const { requireHelperCapability } = require('../middleware/requireAccess');
const { requireOnboardingStep } = require('../middleware/helperOnboardingMiddleware');
const pool = require('../db');

const router = express.Router();
const { scopeExempt } = require('../middleware/scopeGates');

// Booking routes serve both helper-owned bookings and business bookings. Only
// helper-owned provider mutations need the helper capability; business members
// continue through bookingLifecycle's business-scope authorization.
const requireBookingProviderCapability = async (req, res, next) => {
  if (!req.params?.bookingId) return next();
  try {
    const { rows } = await pool.query(
      'SELECT business_id FROM booking_requests WHERE id = $1',
      [req.params.bookingId],
    );
    req.bookingProviderNeedsActivation = Boolean(rows[0] && !rows[0].business_id);
    if (!req.bookingProviderNeedsActivation) return next();
    return requireHelperCapability(req, res, next);
  } catch (err) {
    return next(err);
  }
};

// Business providers use their organization scope; helper-owned bookings must
// be fully activated before accepting work or counter-proposing a time. Keep
// decline/cancel available so revoked helpers can safely unwind existing work.
const requireBookingProviderActivation = (req, res, next) => {
  if (!req.bookingProviderNeedsActivation) return next();
  return requireOnboardingStep('active')(req, res, next);
};

// Review P2-7-F06/F08: booking requests lead to payment; require verified
// email and current terms acceptance.
router.post('/', requireAuth, requireEmailVerified, requireTermsAcceptance, bookingController.createBookingRequest);
router.get('/', requireAuth, bookingController.getMyBookingRequests);
router.get('/incoming', requireAuth, bookingController.getIncomingBookingRequests);

/** Static paths must be registered before /:bookingId */
router.get('/status/:token', bookingController.getPublicBookingStatus);
// G-6: recipient accept/decline via their invite token. Optional auth so a
// signed-in recipient links their account on accept; token-only otherwise.
router.post('/status/:token/respond', optionalAuth, bookingController.respondToRecipientInvite);
// Group 3 (Recipient and sponsor): token-gated participant surfaces. No
// sign-in: the token is the credential, mirroring the respond route above.
router.get('/status/:token/summary', bookingRecipientController.getTokenParticipantSummary);
router.get('/status/:token/checklist', bookingRecipientController.getTokenChecklist);
router.get('/status/:token/receipt', bookingRecipientController.getTokenReceipt);
router.get('/status/:token/support', bookingRecipientController.listTokenSupportIntake);
router.post('/status/:token/site-actions', bookingRecipientController.recordTokenSiteAction);
router.post('/status/:token/renewal-request', bookingRecipientController.requestTokenLinkRenewal);
router.post('/status/:token/update-email', bookingRecipientController.registerUpdateEmail);
router.post('/status/:token/update-email/remove', bookingRecipientController.removeUpdateEmail);
router.post('/status/:token/notifications/opt-out', bookingRecipientController.optOutTokenNotifications);
router.post('/status/:token/archive', bookingRecipientController.archiveTokenVisit);
router.post('/status/:token/support', bookingRecipientController.submitTokenSupportIntake);
router.post('/status/:token/feedback', bookingRecipientController.submitTokenFeedback);
router.post('/status/:token/photos', upload.single('file'), validateFileUpload, bookingRecipientController.uploadTokenSitePhoto);
router.post('/status/:token/contact-correction', bookingRecipientController.submitTokenContactCorrection);
router.post('/status/:token/relay-message', bookingRecipientController.relayTokenMessage);
router.get('/status/:token/sponsor', bookingRecipientController.getSponsorPreviewByToken);
router.post('/status/:token/sponsor/respond', bookingRecipientController.respondToSponsorshipByToken);
router.get('/recurring', requireAuth, bookingController.listRecurringBookings);
router.post('/recurring', requireAuth, bookingController.createRecurringBooking);
router.post('/recurring/:id/cancel', requireAuth, bookingController.updateRecurringBookingStatus);
router.post('/recurring/:id/pause', requireAuth, bookingController.updateRecurringBookingStatus);
router.post('/recurring/:id/resume', requireAuth, bookingController.updateRecurringBookingStatus);
router.get('/business/:businessId/available-slots', scopeExempt('public-storefront'), bookingController.getBusinessAvailableSlots);
router.get('/helper/:helperId/available-slots', bookingController.getHelperAvailableSlots);

router.get('/:bookingId', requireAuth, bookingController.getBookingRequest);
// G-6: account-linked recipient accept/decline; booker revokes the links.
router.post('/:bookingId/recipient/respond', requireAuth, bookingController.respondAsRecipient);
router.post('/:bookingId/status-link/revoke', requireAuth, bookingController.revokeStatusLink);
router.post('/:bookingId/accept', requireAuth, requireBookingProviderCapability, requireBookingProviderActivation, bookingController.acceptBookingRequest);
router.post('/:bookingId/decline', requireAuth, requireBookingProviderCapability, bookingController.declineBookingRequest);
router.post('/:bookingId/cancel', requireAuth, bookingController.cancelBookingRequest);
router.post('/:bookingId/reschedule', requireAuth, bookingController.proposeReschedule);
router.post('/:bookingId/reschedule/:proposalId/respond', requireAuth, bookingController.respondToReschedule);
router.get('/:bookingId/reschedule', requireAuth, bookingController.listReschedules);
router.post('/:bookingId/helper-cancel', requireAuth, requireBookingProviderCapability, bookingController.helperCancelAcceptedBooking);
// G-37: transfer an accepted booking to another eligible provider.
// No activation gate for the caller: a revoked helper can still hand
// existing work to someone who can do it, like decline/cancel.
router.post('/:bookingId/transfer', requireAuth, requireBookingProviderCapability, bookingController.transferBookingRequest);
router.post('/:bookingId/counter-propose', requireAuth, requireBookingProviderCapability, requireBookingProviderActivation, bookingController.counterProposeBooking);
router.post('/:bookingId/counter-propose/respond', requireAuth, bookingController.respondToCounterPropose);
router.post('/:bookingId/convert-to-job', requireAuth, bookingController.convertBookingToJob);
// Group 3 (Recipient and sponsor): account participant surfaces.
router.get('/:bookingId/participant-summary', requireAuth, bookingRecipientController.getParticipantSummary);
router.get('/:bookingId/sharing-preview', requireAuth, bookingRecipientController.getSharingPreview);
router.get('/:bookingId/checklist', requireAuth, bookingRecipientController.getChecklist);
router.get('/:bookingId/site-actions', requireAuth, bookingRecipientController.listSiteActions);
router.post('/:bookingId/site-actions', requireAuth, bookingRecipientController.recordSiteAction);
router.post('/:bookingId/arrive', requireAuth, bookingRecipientController.markProviderArrived);
router.post('/:bookingId/care-instructions', requireAuth, bookingRecipientController.setCareInstructions);
router.post('/:bookingId/receipt/share', requireAuth, bookingRecipientController.shareReceipt);
router.get('/:bookingId/receipt', requireAuth, bookingRecipientController.getReceipt);
router.post('/:bookingId/contacts/replace', requireAuth, bookingRecipientController.replaceContact);
router.post('/:bookingId/guest-access/remove', requireAuth, bookingRecipientController.removeGuestAccess);
router.post('/:bookingId/link-renewal/request', requireAuth, bookingRecipientController.requestLinkRenewal);
router.post('/:bookingId/status-link/renew', requireAuth, bookingRecipientController.renewStatusLink);
router.post('/:bookingId/link-delivery', requireAuth, bookingRecipientController.deliverLinkToAlternate);
router.post('/:bookingId/notifications/opt-out', requireAuth, bookingRecipientController.optOutNotifications);
router.post('/:bookingId/notifications/opt-in', requireAuth, bookingRecipientController.optInNotifications);
router.post('/:bookingId/archive-visit', requireAuth, bookingRecipientController.archiveVisit);
router.post('/:bookingId/archive-visit/remove', requireAuth, bookingRecipientController.unarchiveVisit);
router.post('/:bookingId/contact-correction', requireAuth, bookingRecipientController.submitContactCorrection);
router.post('/:bookingId/relay-message', requireAuth, bookingRecipientController.relayMessage);
router.post('/:bookingId/support', requireAuth, bookingRecipientController.submitSupportIntake);
router.get('/:bookingId/support', requireAuth, bookingRecipientController.listSupportIntake);
router.get('/:bookingId/callbacks', requireAuth, bookingRecipientController.listCallbacks);
router.post('/:bookingId/feedback', requireAuth, bookingRecipientController.submitFeedback);
router.get('/:bookingId/feedback', requireAuth, bookingRecipientController.listFeedback);
router.post('/:bookingId/photos', requireAuth, upload.single('file'), validateFileUpload, bookingRecipientController.uploadSitePhoto);
router.get('/:bookingId/photos', requireAuth, bookingRecipientController.listSitePhotos);
router.get('/:bookingId/payment-breakdown', requireAuth, bookingRecipientController.getPaymentBreakdown);
// Group 3 sponsorships: invite, respond, pay with the sponsor's own card.
router.post('/:bookingId/sponsorships', requireAuth, bookingRecipientController.createSponsorship);
router.get('/:bookingId/sponsorships', requireAuth, bookingRecipientController.listSponsorships);
router.post('/:bookingId/sponsorships/:sponsorshipId/respond', requireAuth, bookingRecipientController.respondToSponsorship);
router.post('/:bookingId/sponsorships/:sponsorshipId/payment-intent', requireAuth, bookingRecipientController.createSponsorPaymentIntent);
router.post('/:bookingId/sponsorships/:sponsorshipId/confirm-payment', requireAuth, bookingRecipientController.confirmSponsorPayment);
router.get('/:bookingId/sponsorships/:sponsorshipId/receipt', requireAuth, bookingRecipientController.getSponsorReceipt);
router.post('/:bookingId/sponsorships/:sponsorshipId/charges', requireAuth, bookingRecipientController.requestAdditionalCharge);
router.get('/:bookingId/sponsorships/:sponsorshipId/charges', requireAuth, bookingRecipientController.listAdditionalCharges);
router.post('/:bookingId/sponsorships/:sponsorshipId/charges/:chargeId/respond', requireAuth, bookingRecipientController.respondToCharge);
router.post('/:bookingId/sponsorships/:sponsorshipId/charges/:chargeId/payment-intent', requireAuth, bookingRecipientController.createChargePaymentIntent);
router.post('/:bookingId/sponsorships/:sponsorshipId/charges/:chargeId/confirm-payment', requireAuth, bookingRecipientController.confirmChargePayment);

module.exports = router;
