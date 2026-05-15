const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const businessMessagingController = require('../controllers/businessMessagingController');
const businessServicesController = require('../controllers/businessServicesController');
const businessAppointmentsController = require('../controllers/businessAppointmentsController');
const dynamicPricingController = require('../controllers/dynamicPricingController');

// ── MESSAGING ROUTES ──────────────────────────────────────────
router.get('/:businessId/messages', requireAuth, businessMessagingController.getConversations);
router.post('/:businessId/messages', requireAuth, businessMessagingController.createConversation);
router.get('/:businessId/messages/:conversationId', requireAuth, businessMessagingController.getConversation);
router.post('/:businessId/messages/:conversationId', requireAuth, businessMessagingController.sendMessage);
router.post('/:businessId/messages/:conversationId/archive', requireAuth, businessMessagingController.archiveConversation);

// ── SERVICES ROUTES ───────────────────────────────────────────
router.get('/:businessId/services', businessServicesController.listServices);
router.post('/:businessId/services', requireAuth, businessServicesController.createService);
router.put('/:businessId/services/:serviceId', requireAuth, businessServicesController.updateService);
router.post('/:businessId/services/:serviceId/staff', requireAuth, businessServicesController.assignStaffToService);
router.post('/:businessId/services/:serviceId/availability', requireAuth, businessServicesController.setServiceAvailability);
router.get('/:businessId/services/:serviceId/slots', businessServicesController.getAvailableSlots);

// ── APPOINTMENTS ROUTES ───────────────────────────────────────
router.post('/:businessId/appointments', requireAuth, businessAppointmentsController.createAppointment);
router.get('/:businessId/appointments', requireAuth, businessAppointmentsController.listAppointments);
router.get('/:businessId/appointments/:appointmentId', requireAuth, businessAppointmentsController.getAppointment);
router.put('/:businessId/appointments/:appointmentId/status', requireAuth, businessAppointmentsController.updateAppointmentStatus);
router.post('/:businessId/appointments/:appointmentId/cancel', requireAuth, businessAppointmentsController.cancelAppointment);
router.post('/:businessId/appointments/:appointmentId/reschedule', requireAuth, businessAppointmentsController.rescheduleAppointment);
router.post('/:businessId/appointments/:appointmentId/notes', requireAuth, businessAppointmentsController.addAppointmentNote);

// ── DYNAMIC PRICING ROUTES ────────────────────────────────────
router.get('/:businessId/services/:serviceId/calculate-price', dynamicPricingController.calculatePrice);
router.post('/:businessId/pricing-rules', requireAuth, dynamicPricingController.createPricingRule);
router.get('/:businessId/pricing-rules', requireAuth, dynamicPricingController.listPricingRules);
router.get('/:businessId/services/:serviceId/pricing-rules', requireAuth, dynamicPricingController.listPricingRules);
router.put('/:businessId/pricing-rules/:ruleId', requireAuth, dynamicPricingController.updatePricingRule);
router.delete('/:businessId/pricing-rules/:ruleId', requireAuth, dynamicPricingController.deletePricingRule);

module.exports = router;
