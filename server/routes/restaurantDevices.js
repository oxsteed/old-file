'use strict';

// F-26: unified device fleet routes (mounted under /api/restaurants).
// Additive; the legacy pairing endpoints are untouched.

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const { requireRestaurantAccess } = require('../middleware/scopeGates');
const { authenticatedLimiter } = require('../middleware/rateLimiter');
const fleet = require('../controllers/restaurantDeviceController');

router.get('/:restaurantId/devices/registry', authenticate, rejectImpersonated, requireRestaurantAccess(), authenticatedLimiter, fleet.listFleet);
router.patch('/:restaurantId/devices/registry/:deviceId', authenticate, rejectImpersonated, requireRestaurantAccess(), authenticatedLimiter, fleet.setDeviceStatus);

module.exports = router;
