const express = require('express');
const router = express.Router();

const appointmentController = require('../controllers/appointmentController');
const availabilityController = require('../controllers/availabilityController');
const calendarNotificationController = require('../controllers/calendarNotificationController');

const authenticate = require('../middleware/auth').authenticate;
const rateLimiter = require('../middleware/rateLimiter').generalLimiter;

// Appointments
router.post('/appointments', authenticate, rateLimiter, appointmentController.createAppointment);
router.get('/appointments', authenticate, appointmentController.getAppointments);
router.get('/appointments/:id', authenticate, appointmentController.getAppointment);
router.post('/appointments/:id/confirm', authenticate, rateLimiter, appointmentController.confirmAppointment);
router.post('/appointments/:id/cancel', authenticate, rateLimiter, appointmentController.cancelAppointment);

// Availability blocks
router.post('/availability', authenticate, rateLimiter, availabilityController.createAvailabilityBlock);
router.get('/availability/helpers/:helper_id', availabilityController.getAvailabilityBlocks);
router.get('/availability/mine', authenticate, availabilityController.getMyAvailabilityBlocks);
router.put('/availability/:id', authenticate, rateLimiter, availabilityController.updateAvailabilityBlock);
router.delete('/availability/:id', authenticate, rateLimiter, availabilityController.deleteAvailabilityBlock);

// Notification preferences
router.get('/notification-preferences', authenticate, availabilityController.getNotificationPreferences);
router.put('/notification-preferences', authenticate, rateLimiter, availabilityController.updateNotificationPreferences);

// Notifications
router.get('/notifications', authenticate, calendarNotificationController.getPendingNotifications);
router.post('/notifications/:id/read', authenticate, rateLimiter, calendarNotificationController.markNotificationAsRead);
router.get('/notifications/stats', authenticate, calendarNotificationController.getNotificationStats);

module.exports = router;
