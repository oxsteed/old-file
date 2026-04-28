const router = require('express').Router();
const { discoverLimiter, discoverAuthLimiter } = require('../middleware/rateLimiter');
const { authenticate } = require('../middleware/auth');
const {
  discoverSearch,
  discoverPopular,
  listDiscoverAlerts,
  createDiscoverAlert,
  deleteDiscoverAlert,
} = require('../controllers/discoverController');

router.get('/popular', discoverLimiter, discoverAuthLimiter, discoverPopular);
router.get('/', discoverLimiter, discoverAuthLimiter, discoverSearch);
router.get('/alerts', authenticate, listDiscoverAlerts);
router.post('/alerts', authenticate, createDiscoverAlert);
router.delete('/alerts/:id', authenticate, deleteDiscoverAlert);

module.exports = router;
