'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/restaurantSupportController');

// This router is mounted at `/api/restaurants`, alongside public restaurant,
// device-authenticated, and optional-auth media routes. Keep authentication
// limited to the support route families so this router cannot block those
// neighboring routes by mount order.
router.use('/support', authenticate);
router.use('/:restaurantId/support', authenticate);

// Customer case surface.
router.post('/support/cases', ctrl.createCase);
router.get('/support/cases/my', ctrl.listMyCases);
router.get('/support/cases/:caseId', ctrl.getMyCase);
router.post('/support/cases/:caseId/messages', ctrl.addCustomerMessage);
router.post('/support/cases/:caseId/attachments', ctrl.addAttachment);
router.post('/support/cases/:caseId/reopen', ctrl.reopenCase);
router.post('/support/cases/:caseId/accept-resolution', ctrl.acceptResolution);

// Restaurant manager / owner app surface.
router.get('/:restaurantId/support/cases', ctrl.listRestaurantCases);
router.get('/:restaurantId/support/cases/:caseId', ctrl.getRestaurantCase);
router.post('/:restaurantId/support/cases/:caseId/respond', ctrl.restaurantRespond);
router.post('/:restaurantId/support/cases/:caseId/internal-note', ctrl.restaurantInternalNote);
router.post('/:restaurantId/support/cases/:caseId/assign', ctrl.restaurantAssign);
router.post('/:restaurantId/support/cases/:caseId/offer-resolution', ctrl.restaurantOfferResolution);
router.post('/:restaurantId/support/cases/:caseId/resolve', ctrl.restaurantResolve);
router.post('/:restaurantId/support/cases/:caseId/escalate', ctrl.restaurantEscalate);
router.get('/:restaurantId/support/summary', ctrl.getRestaurantSummary);

module.exports = router;
