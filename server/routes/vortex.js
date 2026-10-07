'use strict';

/**
 * Top-level Vortex routes — entry-point flow for users redeeming a
 * per-business access code (sharable code from owner / manager).
 *
 * Mounted as:
 *   app.use('/api/vortex', vortexRoutes);
 *   app.use('/api/me',     vortexRoutes);   // see below
 *
 * The /me endpoints (workspace listing + last-selected) live here too
 * because they belong to the same user-flow as Vortex (workspace switcher
 * lives on the Vortex page).
 */

const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireFeatureEnabled } = require('../middleware/featureFlags');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const { vortexRedeemLimiter } = require('../middleware/rateLimiter');

const access = require('../controllers/businessAccessCodesController');

// Audit fix: Vortex is launch-hidden. Gate the API to match the UI.
const requireVortexEnabled = requireFeatureEnabled('Vortex', 'VORTEX_ENABLED', false);
const team   = require('../controllers/businessTeamController');

// ── Code preview / redeem ────────────────────────────────────────────────────
router.post('/preview', authenticate, rejectImpersonated, requireVortexEnabled, vortexRedeemLimiter, access.previewCode);
router.post('/redeem',  authenticate, rejectImpersonated, requireVortexEnabled, vortexRedeemLimiter, access.redeemCode);

module.exports = router;
