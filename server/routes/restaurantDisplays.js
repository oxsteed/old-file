'use strict';

// OxSteed Restaurants — display pairing (mounted at /api/restaurant/displays).
// Wall displays (queue board, kiosk, kitchen screen) are public, no-login
// pages on TVs; this router pairs a TV to a restaurant without any staff
// session on the TV itself. Owner mutations require the restaurant's owner
// (resolveRestaurantAccess effective_role 'owner'), enforced in the
// controller, and reject impersonated sessions like the rest of the
// restaurant surface.

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const { strictLimiter, generalLimiter, authenticatedLimiter } = require('../middleware/rateLimiter');
const displays = require('../controllers/restaurantDisplayController');

// Public pairing flow for the TV. No tenant path param here (only :id on the
// owner routes), so the route scope guard does not apply; restaurant identity
// comes from the request body and ownership is enforced in the controller via
// the canonical restaurant access check.
router.post('/pairing-code', strictLimiter, displays.issuePairingCode);
router.post('/status', strictLimiter, displays.pairingStatus);

// Paired displays authenticate with their pairing token (Authorization: Bearer).
router.post('/heartbeat', generalLimiter, displays.heartbeat);

// Owner fleet management.
router.post('/claim', authenticate, rejectImpersonated, strictLimiter, displays.claimDisplay);
router.get('/', authenticate, rejectImpersonated, authenticatedLimiter, displays.listPairings);
router.post('/:id/refresh', authenticate, rejectImpersonated, authenticatedLimiter, displays.requestRefresh);
router.delete('/:id', authenticate, rejectImpersonated, authenticatedLimiter, displays.unpairDisplay);

module.exports = router;
