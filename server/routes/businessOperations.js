const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const enforceBookingRules = require('../middleware/enforceBookingRules');
const businessMessagingController = require('../controllers/businessMessagingController');
const businessServicesController = require('../controllers/businessServicesController');
const businessAppointmentsController = require('../controllers/businessAppointmentsController');
const dynamicPricingController = require('../controllers/dynamicPricingController');
const businessConversationAssignmentController = require('../controllers/businessConversationAssignmentController');
const businessCalendarController = require('../controllers/businessCalendarController');
const loyaltyTiersController    = require('../controllers/loyaltyTiersController');

// ── MESSAGING ROUTES ──────────────────────────────────────────
router.get ('/:businessId/messages',                                       requireAuth, requireBusinessAccess({ minRole: 'any' }),     businessMessagingController.getConversations);
router.post('/:businessId/messages',                                       requireAuth, requireBusinessAccess({ minRole: 'any' }),     businessMessagingController.createConversation);
router.get ('/:businessId/messages/:conversationId',                       requireAuth, requireBusinessAccess({ minRole: 'any' }),     businessMessagingController.getConversation);
router.post('/:businessId/messages/:conversationId',                       requireAuth, requireBusinessAccess({ minRole: 'any' }),     businessMessagingController.sendMessage);
router.post('/:businessId/messages/:conversationId/archive',               requireAuth, requireBusinessAccess({ minRole: 'any' }),     businessMessagingController.archiveConversation);

// Phase 1c
router.get ('/:businessId/messages/assignments/list',                      requireAuth, requireBusinessAccess({ minRole: 'any' }),     businessConversationAssignmentController.listAssignments);
router.post('/:businessId/messages/:conversationId/claim',                 requireAuth, requireBusinessAccess({ minRole: 'any' }),     businessConversationAssignmentController.claimConversation);
router.post('/:businessId/messages/:conversationId/release',               requireAuth, requireBusinessAccess({ minRole: 'any' }),     businessConversationAssignmentController.releaseConversation);
router.post('/:businessId/messages/:conversationId/reassign',              requireAuth, requireBusinessAccess({ minRole: 'manager' }), businessConversationAssignmentController.reassignConversation);

// ── SERVICES ROUTES ───────────────────────────────────────────
router.get ('/:businessId/services',                                                                                                    businessServicesController.listServices);
router.post('/:businessId/services',                                       requireAuth, requireBusinessAccess({ minRole: 'manager' }), businessServicesController.createService);
router.put ('/:businessId/services/:serviceId',                            requireAuth, requireBusinessAccess({ minRole: 'manager' }), businessServicesController.updateService);
router.post('/:businessId/services/:serviceId/staff',                      requireAuth, requireBusinessAccess({ minRole: 'manager' }), businessServicesController.assignStaffToService);
router.post('/:businessId/services/:serviceId/availability',               requireAuth, requireBusinessAccess({ minRole: 'manager' }), businessServicesController.setServiceAvailability);

// Phase 2b: real slot engine. Public (customers can see availability without auth).
router.get ('/:businessId/services/:serviceId/slots',                                                                                   businessCalendarController.getServiceSlots);

// ── APPOINTMENTS ROUTES ───────────────────────────────────────
// Phase 2c: enforce business_booking_rules + per-staff overbooking guard before insert.
router.post('/:businessId/appointments',                                   requireAuth, requireBusinessAccess({ minRole: 'any' }),     enforceBookingRules, businessAppointmentsController.createAppointment);
router.get ('/:businessId/appointments',                                   requireAuth, requireBusinessAccess({ minRole: 'any' }),     businessAppointmentsController.listAppointments);
router.get ('/:businessId/appointments/calendar',                          requireAuth, requireBusinessAccess({ minRole: 'any' }),     businessCalendarController.getBusinessAppointmentsCalendar);
router.get ('/:businessId/appointments/:appointmentId',                    requireAuth, requireBusinessAccess({ minRole: 'any' }),     businessAppointmentsController.getAppointment);
router.put ('/:businessId/appointments/:appointmentId/status',             requireAuth, requireBusinessAccess({ minRole: 'any' }),     businessAppointmentsController.updateAppointmentStatus);
router.post('/:businessId/appointments/:appointmentId/cancel',             requireAuth, requireBusinessAccess({ minRole: 'any' }),     businessAppointmentsController.cancelAppointment);
router.post('/:businessId/appointments/:appointmentId/reschedule',         requireAuth, requireBusinessAccess({ minRole: 'any' }),     businessAppointmentsController.rescheduleAppointment);
router.post('/:businessId/appointments/:appointmentId/notes',              requireAuth, requireBusinessAccess({ minRole: 'any' }),     businessAppointmentsController.addAppointmentNote);

// ── DYNAMIC PRICING ROUTES ────────────────────────────────────
router.get   ('/:businessId/services/:serviceId/calculate-price',                                                                       dynamicPricingController.calculatePrice);
router.post  ('/:businessId/pricing-rules',                                requireAuth, requireBusinessAccess({ minRole: 'manager' }), dynamicPricingController.createPricingRule);
router.get   ('/:businessId/pricing-rules',                                requireAuth, requireBusinessAccess({ minRole: 'any' }),     dynamicPricingController.listPricingRules);
router.get   ('/:businessId/services/:serviceId/pricing-rules',            requireAuth, requireBusinessAccess({ minRole: 'any' }),     dynamicPricingController.listPricingRules);
router.put   ('/:businessId/pricing-rules/:ruleId',                        requireAuth, requireBusinessAccess({ minRole: 'manager' }), dynamicPricingController.updatePricingRule);
router.delete('/:businessId/pricing-rules/:ruleId',                        requireAuth, requireBusinessAccess({ minRole: 'manager' }), dynamicPricingController.deletePricingRule);

// ── LOYALTY TIER ROUTES ───────────────────────────────────────
router.get   ('/:businessId/loyalty-tiers',                   requireAuth, requireBusinessAccess({ minRole: 'any'     }), loyaltyTiersController.listLoyaltyTiers);
router.post  ('/:businessId/loyalty-tiers',                   requireAuth, requireBusinessAccess({ minRole: 'manager' }), loyaltyTiersController.createLoyaltyTier);
router.put   ('/:businessId/loyalty-tiers/:tierId',           requireAuth, requireBusinessAccess({ minRole: 'manager' }), loyaltyTiersController.updateLoyaltyTier);
router.delete('/:businessId/loyalty-tiers/:tierId',           requireAuth, requireBusinessAccess({ minRole: 'manager' }), loyaltyTiersController.deleteLoyaltyTier);
router.get   ('/:businessId/loyalty/tier/:tierId/customers',  requireAuth, requireBusinessAccess({ minRole: 'any'     }), loyaltyTiersController.listTierCustomers);

module.exports = router;
