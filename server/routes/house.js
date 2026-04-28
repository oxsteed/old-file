/**
 * routes/house.js
 * Home profile + address lookup (Census + OSM + FEMA)
 * OxSteed v2
 */

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { geoLimiter }   = require('../middleware/rateLimiter');
const ctrl = require('../controllers/houseController');

// Public address lookup — rate-limited, no auth
router.get('/lookup', geoLimiter, ctrl.lookupAddress);

// User home profiles — authenticated
router.get   ('/my',     authenticate, ctrl.listMyHomes);
router.post  ('/my',     authenticate, ctrl.addHome);
router.patch ('/my/:id', authenticate, ctrl.updateHome);
router.delete('/my/:id', authenticate, ctrl.deleteHome);

module.exports = router;
