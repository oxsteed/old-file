'use strict';

// F-08: in-store hub routes (mounted under /api/restaurants).
// Staff endpoints are authenticated + restaurant-scoped; the hub's own
// endpoints authenticate with its designated device credential.

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const { requireRestaurantAccess, scopeExempt } = require('../middleware/scopeGates');
const { authenticatedLimiter, strictLimiter } = require('../middleware/rateLimiter');
const hub = require('../controllers/storeHubController');

// Staff: register/list hubs, trigger replay, reconcile offline sales.
router.get('/:restaurantId/hubs', authenticate, rejectImpersonated, requireRestaurantAccess(), authenticatedLimiter, hub.listHubs);
router.post('/:restaurantId/hubs', authenticate, rejectImpersonated, requireRestaurantAccess(), authenticatedLimiter, hub.registerHub);
router.post('/:restaurantId/hubs/:hubId/replay', authenticate, rejectImpersonated, requireRestaurantAccess(), strictLimiter, hub.replaySales);
router.get('/:restaurantId/hubs/:hubId/offline-sales', authenticate, rejectImpersonated, requireRestaurantAccess(), authenticatedLimiter, hub.listOfflineSales);

// The hub device itself: heartbeat, revision-journal pull, offline sale queue.
router.post('/:restaurantId/hubs/:hubId/heartbeat', strictLimiter, scopeExempt('device-credential'), hub.authenticateHubDevice, hub.deviceHeartbeat);
router.get('/:restaurantId/hubs/:hubId/changes', scopeExempt('device-credential'), hub.authenticateHubDevice, hub.devicePull);
router.post('/:restaurantId/hubs/:hubId/offline-sales', strictLimiter, scopeExempt('device-credential'), hub.authenticateHubDevice, hub.deviceQueueSales);

module.exports = router;
