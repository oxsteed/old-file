const express = require('express');
const { requireAuth } = require('../middleware/auth');
const requireEmailVerified = require('../middleware/requireEmailVerified');
const requireTermsAcceptance = require('../middleware/requireTermsAcceptance');
const bookingController = require('../controllers/bookingController');
const { requireHelperCapability } = require('../middleware/requireAccess');
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
    if (!rows[0] || rows[0].business_id) return next();
    return requireHelperCapability(req, res, next);
  } catch (err) {
    return next(err);
  }
};

// Review P2-7-F06/F08: booking requests lead to payment; require verified
// email and current terms acceptance.
router.post('/', requireAuth, requireEmailVerified, requireTermsAcceptance, bookingController.createBookingRequest);
router.get('/', requireAuth, bookingController.getMyBookingRequests);
router.get('/incoming', requireAuth, bookingController.getIncomingBookingRequests);

/** Static paths must be registered before /:bookingId */
router.get('/recurring', requireAuth, bookingController.listRecurringBookings);
router.post('/recurring', requireAuth, bookingController.createRecurringBooking);
router.post('/recurring/:id/cancel', requireAuth, bookingController.updateRecurringBookingStatus);
router.post('/recurring/:id/pause', requireAuth, bookingController.updateRecurringBookingStatus);
router.post('/recurring/:id/resume', requireAuth, bookingController.updateRecurringBookingStatus);
router.get('/business/:businessId/available-slots', scopeExempt('public-storefront'), bookingController.getBusinessAvailableSlots);
router.get('/helper/:helperId/available-slots', bookingController.getHelperAvailableSlots);

router.get('/:bookingId', requireAuth, bookingController.getBookingRequest);
router.post('/:bookingId/accept', requireAuth, requireBookingProviderCapability, bookingController.acceptBookingRequest);
router.post('/:bookingId/decline', requireAuth, requireBookingProviderCapability, bookingController.declineBookingRequest);
router.post('/:bookingId/cancel', requireAuth, bookingController.cancelBookingRequest);
router.post('/:bookingId/helper-cancel', requireAuth, requireBookingProviderCapability, bookingController.helperCancelAcceptedBooking);
router.post('/:bookingId/counter-propose', requireAuth, requireBookingProviderCapability, bookingController.counterProposeBooking);
router.post('/:bookingId/counter-propose/respond', requireAuth, bookingController.respondToCounterPropose);
router.post('/:bookingId/convert-to-job', requireAuth, bookingController.convertBookingToJob);

module.exports = router;
