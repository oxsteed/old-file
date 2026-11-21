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

// Create the pending_confirmation scheduled row that unblocks payment +
// booking for a client-owned session (see createScheduledSession).
router.post('/sessions', authenticate, consultantSchedulingController.createScheduledSession);

// Book a time slot for a session
router.post('/sessions/:sessionId/book-slot', authenticate, consultantSchedulingController.bookTimeSlot);

// Group 10 Slice C (518-520): session detail, reschedule proposals,
// cancellation, attendance. The by-consulting route must precede the
// :sessionId route so "by-consulting" is not captured as an id.
router.get('/sessions/by-consulting/:consultingSessionId', authenticate, consultantSchedulingController.getScheduledSessionDetailByConsulting);
router.get('/sessions/:sessionId', authenticate, consultantSchedulingController.getScheduledSessionDetail);
router.post('/sessions/:sessionId/reschedules', authenticate, consultantSchedulingController.proposeReschedule);
router.get('/sessions/:sessionId/reschedules', authenticate, consultantSchedulingController.listReschedules);
router.post('/sessions/:sessionId/reschedules/:proposalId/accept', authenticate, consultantSchedulingController.acceptReschedule);
router.post('/sessions/:sessionId/reschedules/:proposalId/decline', authenticate, consultantSchedulingController.declineReschedule);
router.post('/sessions/:sessionId/reschedules/:proposalId/withdraw', authenticate, consultantSchedulingController.withdrawReschedule);
router.post('/sessions/:sessionId/cancel', authenticate, consultantSchedulingController.cancelScheduledSession);
router.post('/sessions/:sessionId/attendance', authenticate, consultantSchedulingController.confirmAttendance);
router.get('/sessions/:sessionId/attendance', authenticate, consultantSchedulingController.listAttendance);

module.exports = router;
