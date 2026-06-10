// server/routes/countryConfig.js
//
// Mounted at /api/country-config (see server/index.js).
//   GET   /countries        public — picker list (available + coming_soon)
//   GET   /                 public — full pack for ?country=XX (default US)
//   PATCH /admin/:code      super-admin — flip status / patch config

const router = require('express').Router();
const { generalLimiter } = require('../middleware/rateLimiter');
const { requireSuperAdmin } = require('../middleware/adminAuth');
const ctrl = require('../controllers/countryPackController');

router.get('/countries', generalLimiter, ctrl.listCountries);
router.get('/', generalLimiter, ctrl.getCountryConfig);
router.patch('/admin/:code', requireSuperAdmin, ctrl.adminUpdateCountryPack);

module.exports = router;
