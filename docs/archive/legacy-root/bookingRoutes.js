/**
 * Booking System Routes
 * Routes for appointment booking, availability, and customer management
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireAuth } = require('../middleware/auth');
const bookingController = require('../controllers/bookingController');

// ============================================================================
// Availability (public and private)
// ============================================================================

// Get available slots for a service (public - no auth required)
router.get(
  '/businesses/:businessId/services/:serviceId/availability',
  bookingController.getServiceAvailability
);

// Get business availability summary/heatmap
router.get(
  '/businesses/:businessId/availability',
  bookingController.getBusinessAvailability
);

// ============================================================================
// Booking Management
// ============================================================================

// Create a new booking (can be public or authenticated)
router.post('/businesses/:businessId/bookings', bookingController.createBooking);

// Get all bookings for a customer
router.get('/businesses/:businessId/bookings/my', requireAuth, bookingController.getMyBookings);

// Get all bookings for a business (admin view)
router.get('/businesses/:businessId/bookings', requireAuth, bookingController.getBusinessBookings);

// Get a single booking
router.get(
  '/businesses/:businessId/bookings/:bookingId',
  requireAuth,
  bookingController.getBooking
);

// Update booking status
router.put(
  '/businesses/:businessId/bookings/:bookingId',
  requireAuth,
  bookingController.updateBookingStatus
);

// Cancel a booking
router.post(
  '/businesses/:businessId/bookings/:bookingId/cancel',
  requireAuth,
  bookingController.cancelBooking
);

module.exports = router;
