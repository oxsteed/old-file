const express = require('express');
const router = express.Router();
const consultantSchedulingController = require('../controllers/consultantSchedulingController');
const { authenticate } = require('../middleware/auth');

// Public endpoints - get available slots (no auth required)
router.get('/consultants/:consultantId/available-slots', consultantSchedulingController.getAvailableSlots);
router.get('/consultants/:consultantId/next-available', consultantSchedulingController.getNextAvailableDates);

// Authenticated endpoints - consultant manages own availability
router.get('/consultants/:consultantId/availability', authenticate, consultantSchedulingController.getConsultantAvailability);
router.post('/consultants/:consultantId/availability', authenticate, consultantSchedulingController.setAvailability);

router.get('/consultants/:consultantId/blocked-dates', authenticate, consultantSchedulingController.getBlockedDates);
router.post('/consultants/:consultantId/blocked-dates', authenticate, consultantSchedulingController.addBlockedDate);
router.delete('/consultants/:consultantId/blocked-dates/:dateId', authenticate, consultantSchedulingController.removeBlockedDate);

// Book a time slot for a session
router.post('/sessions/:sessionId/book-slot', authenticate, consultantSchedulingController.bookTimeSlot);

module.exports = router;
