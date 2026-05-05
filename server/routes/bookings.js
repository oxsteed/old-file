const express = require('express');
const { requireAuth } = require('../middleware/auth');
const bookingController = require('../controllers/bookingController');

const router = express.Router();

router.post('/', requireAuth, bookingController.createBookingRequest);
router.get('/', requireAuth, bookingController.getMyBookingRequests);
router.get('/incoming', requireAuth, bookingController.getIncomingBookingRequests);

/** Static paths must be registered before /:bookingId */
router.get('/helper/:helperId/available-slots', bookingController.getHelperAvailableSlots);

router.get('/:bookingId', requireAuth, bookingController.getBookingRequest);
router.post('/:bookingId/accept', requireAuth, bookingController.acceptBookingRequest);
router.post('/:bookingId/decline', requireAuth, bookingController.declineBookingRequest);
router.post('/:bookingId/cancel', requireAuth, bookingController.cancelBookingRequest);
router.post('/:bookingId/helper-cancel', requireAuth, bookingController.helperCancelAcceptedBooking);
router.post('/:bookingId/convert-to-job', requireAuth, bookingController.convertBookingToJob);

module.exports = router;
