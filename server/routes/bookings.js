const express = require('express');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const requireEmailVerified = require('../middleware/requireEmailVerified');
const requireTermsAcceptance = require('../middleware/requireTermsAcceptance');
const bookingController = require('../controllers/bookingController');
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

module.exports = router;
