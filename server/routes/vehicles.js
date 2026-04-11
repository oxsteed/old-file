/**
 * routes/vehicles.js
 * Car Care — Vehicle routes
 * OxSteed v2
 */

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { geoLimiter }   = require('../middleware/rateLimiter');
const ctrl = require('../controllers/vehicleController');

// ── NHTSA proxy — public, rate-limited same as geo ────────────────────────
router.get('/makes',      geoLimiter, ctrl.getMakes);
router.get('/models',     geoLimiter, ctrl.getModels);
router.get('/vin/:vin',   geoLimiter, ctrl.decodeVin);

// ── User garage — authenticated ───────────────────────────────────────────
router.get   ('/my',     authenticate, ctrl.listMyVehicles);
router.post  ('/my',     authenticate, ctrl.addVehicle);
router.patch ('/my/:id', authenticate, ctrl.updateVehicle);
router.delete('/my/:id', authenticate, ctrl.deleteVehicle);

module.exports = router;
