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

const access = require('../controllers/businessAccessCodesController');
const team   = require('../controllers/businessTeamController');

// ── Code preview / redeem ────────────────────────────────────────────────────
router.post('/preview', authenticate, access.previewCode);
router.post('/redeem',  authenticate, access.redeemCode);

module.exports = router;
