const express = require('express');
const { requireAuth } = require('../middleware/auth');
const bookingController = require('../controllers/bookingController');

const router = express.Router();

/**
 * POST /api/bookings
 * Create a new booking request (customer)
 */
router.post('/', requireAuth, bookingController.createBookingRequest);

/**
 * GET /api/bookings
 * Get current user's booking requests (customer view)
 */
router.get('/', requireAuth, bookingController.getMyBookingRequests);

/**
 * GET /api/bookings/incoming
 * Get incoming booking requests (helper view)
 */
router.get('/incoming', requireAuth, bookingController.getIncomingBookingRequests);

/**
 * GET /api/bookings/:bookingId
 * Get a specific booking request
 */
router.get('/:bookingId', bookingController.getBookingRequest);

/**
 * POST /api/bookings/:bookingId/accept
 * Helper accepts a booking request
 */
router.post('/:bookingId/accept', requireAuth, bookingController.acceptBookingRequest);

/**
 * POST /api/bookings/:bookingId/decline
 * Helper declines a booking request
 */
router.post('/:bookingId/decline', requireAuth, bookingController.declineBookingRequest);

/**
 * POST /api/bookings/:bookingId/cancel
 * Customer cancels a pending booking request
 */
router.post('/:bookingId/cancel', requireAuth, bookingController.cancelBookingRequest);

/**
 * POST /api/bookings/:bookingId/convert-to-job
 * Customer converts failed booking to a job posting
 */
router.post('/:bookingId/convert-to-job', requireAuth, bookingController.convertBookingToJob);

/**
 * GET /api/bookings/helper/:helperId/available-slots?date=YYYY-MM-DD
 * Get available booking slots for a helper on a specific date
 */
router.get('/helper/:helperId/available-slots', bookingController.getHelperAvailableSlots);

module.exports = router;
