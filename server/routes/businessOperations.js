const express = require('express');
const router = express.Router();
const { scopeExempt } = require('../middleware/scopeGates');
const { requireAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const { requireBusinessCalendarAccess } = require('../middleware/requireBusinessCalendarAccess');
const { requireBusinessMessageAccess } = require('../middleware/requireBusinessMessageAccess');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const enforceBookingRules = require('../middleware/enforceBookingRules');
const businessMessagingController = require('../controllers/businessMessagingController');
const businessServicesController = require('../controllers/businessServicesController');
const businessAppointmentsController = require('../controllers/businessAppointmentsController');
const dynamicPricingController = require('../controllers/dynamicPricingController');
const businessConversationAssignmentController = require('../controllers/businessConversationAssignmentController');
const businessCalendarController = require('../controllers/businessCalendarController');
const loyaltyTiersController    = require('../controllers/loyaltyTiersController');

// ── MESSAGING ROUTES ──────────────────────────────────────────
router.get ('/:businessId/messages',                                       requireAuth, requireBusinessAccess({ minRole: 'any' }), requireBusinessMessageAccess('view'),     businessMessagingController.getConversations);
router.post('/:businessId/messages',                                       requireAuth, requireBusinessAccess({ minRole: 'any' }), requireBusinessMessageAccess('create'),     businessMessagingController.createConversation);
router.get ('/:businessId/messages/assignments/list',                      requireAuth, requireBusinessAccess({ minRole: 'any' }), requireBusinessMessageAccess('assign'),     businessConversationAssignmentController.listAssignments);
router.get ('/:businessId/messages/:conversationId',                       requireAuth, requireBusinessAccess({ minRole: 'any' }), requireBusinessMessageAccess('view'),     businessMessagingController.getConversation);
router.post('/:businessId/messages/:conversationId/attachments',            requireAuth, requireBusinessAccess({ minRole: 'any' }), requireBusinessMessageAccess('reply'),     upload.single('file'), validateFileUpload, businessMessagingController.uploadAttachment);
router.post('/:businessId/messages/:conversationId',                       requireAuth, requireBusinessAccess({ minRole: 'any' }), requireBusinessMessageAccess('reply'),     businessMessagingController.sendMessage);
router.post('/:businessId/messages/:conversationId/archive',               requireAuth, requireBusinessAccess({ minRole: 'any' }), requireBusinessMessageAccess('reply'),     businessMessagingController.archiveConversation);
router.post('/:businessId/messages/:conversationId/restore',               requireAuth, requireBusinessAccess({ minRole: 'any' }), requireBusinessMessageAccess('reply'),     businessMessagingController.restoreConversation);
router.post('/:businessId/messages/:conversationId/claim',                 requireAuth, requireBusinessAccess({ minRole: 'any' }), requireBusinessMessageAccess('assign'),     businessConversationAssignmentController.claimConversation);
router.post('/:businessId/messages/:conversationId/release',               requireAuth, requireBusinessAccess({ minRole: 'any' }), requireBusinessMessageAccess('assign'),     businessConversationAssignmentController.releaseConversation);
router.post('/:businessId/messages/:conversationId/reassign',              requireAuth, requireBusinessAccess({ minRole: 'manager' }), requireBusinessMessageAccess('assign'), businessConversationAssignmentController.reassignConversation);

// ── SERVICES ROUTES ───────────────────────────────────────────
router.get ('/:businessId/services',                                                                                                    scopeExempt('public-storefront'), businessServicesController.listServices);
router.post('/:businessId/services',                                       requireAuth, requireBusinessAccess({ minRole: 'manager' }), businessServicesController.createService);
router.put ('/:businessId/services/:serviceId',                            requireAuth, requireBusinessAccess({ minRole: 'manager' }), businessServicesController.updateService);
router.post('/:businessId/services/:serviceId/staff',                      requireAuth, requireBusinessAccess({ minRole: 'manager' }), businessServicesController.assignStaffToService);
router.post('/:businessId/services/:serviceId/availability',               requireAuth, requireBusinessAccess({ minRole: 'manager' }), businessServicesController.setServiceAvailability);

// Phase 2b: real slot engine. Public (customers can see availability without auth).
router.get ('/:businessId/services/:serviceId/slots',                                                                                   scopeExempt('public-storefront'), businessCalendarController.getServiceSlots);

// ── APPOINTMENTS ROUTES ───────────────────────────────────────
// Phase 2c: enforce business_booking_rules + per-staff overbooking guard before insert.
// Customers may book a public business service; the controller validates the
// service/business relationship and binds the appointment to the signed-in user.
router.post('/:businessId/appointments',                                   requireAuth, enforceBookingRules, scopeExempt('public-intake'), businessAppointmentsController.createAppointment);
// P3-8-F10: staff walk-in / phone booking. Same controller, but staff may
// book inside the customer advance-notice window, and the appointment is
// never bound to the staff member's own user id.
router.post('/:businessId/appointments/staff-create',                      requireAuth, requireBusinessAccess({ minRole: 'any' }), requireBusinessCalendarAccess('manageAll'), (req, _res, next) => { req.staffCreated = true; next(); }, businessAppointmentsController.createAppointment);
router.get ('/:businessId/appointments',                                   requireAuth, requireBusinessAccess({ minRole: 'any' }), requireBusinessCalendarAccess('view'),     businessAppointmentsController.listAppointments);
router.get ('/:businessId/appointments/calendar',                          requireAuth, requireBusinessAccess({ minRole: 'any' }), requireBusinessCalendarAccess('view'),     businessCalendarController.getBusinessAppointmentsCalendar);
router.get ('/:businessId/appointments/:appointmentId',                    requireAuth, requireBusinessAccess({ minRole: 'any' }), requireBusinessCalendarAccess('view'),     businessAppointmentsController.getAppointment);
router.put ('/:businessId/appointments/:appointmentId/status',             requireAuth, requireBusinessAccess({ minRole: 'any' }), requireBusinessCalendarAccess('manage'),     businessAppointmentsController.updateAppointmentStatus);
router.post('/:businessId/appointments/:appointmentId/cancel',             requireAuth, requireBusinessAccess({ minRole: 'any' }), requireBusinessCalendarAccess('manage'),     businessAppointmentsController.cancelAppointment);
router.post('/:businessId/appointments/:appointmentId/reschedule',         requireAuth, requireBusinessAccess({ minRole: 'any' }), requireBusinessCalendarAccess('manage'),     businessAppointmentsController.rescheduleAppointment);
router.put ('/:businessId/appointments/:appointmentId/staff',              requireAuth, requireBusinessAccess({ minRole: 'any' }), requireBusinessCalendarAccess('manageAll'),     businessAppointmentsController.reassignAppointmentStaff);
router.post('/:businessId/appointments/:appointmentId/record-payment',    requireAuth, requireBusinessAccess({ minRole: 'any' }), requireBusinessCalendarAccess('payment'),     businessAppointmentsController.recordAppointmentPayment);
router.post('/:businessId/appointments/:appointmentId/notes',              requireAuth, requireBusinessAccess({ minRole: 'any' }), requireBusinessCalendarAccess('manage'),     businessAppointmentsController.addAppointmentNote);

// ── DYNAMIC PRICING ROUTES ────────────────────────────────────
router.get   ('/:businessId/services/:serviceId/calculate-price',                                                                       scopeExempt('public-storefront'), dynamicPricingController.calculatePrice);
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
