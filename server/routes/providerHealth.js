'use strict';

// V2-P1-07 — provider health operator API.
// All endpoints require admin authentication + the manage_operations grant.
// Mounted at /api/provider-health (see server/index.js).

const express = require('express');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const { generalLimiter } = require('../middleware/rateLimiter');
const providerHealthController = require('../controllers/providerHealthController');

const router = express.Router();

router.use(requireAdmin, requirePermission('manage_operations'));

// Aggregate operator view: every provider, capability status, owner, alert
// channel, retry policy, circuit breaker, budget, rotation, customer-safe
// unavailable state. ?refresh=true bypasses the 60s probe cache.
router.get('/', providerHealthController.listProviders);

// Single provider detail.
router.get('/:id', providerHealthController.getProvider);

// Force a fresh live probe for one provider (rate-limited: probes hit vendors).
router.post('/:id/probe', generalLimiter, providerHealthController.runProbe);

// Manually reset a tripped circuit breaker (audit-logged).
router.post('/:id/circuit/reset', generalLimiter, providerHealthController.resetCircuit);

module.exports = router;
