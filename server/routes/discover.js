const router = require('express').Router();
const { discoverLimiter } = require('../middleware/rateLimiter');
const { authenticate } = require('../middleware/auth');
const {
  discoverSearch,
  discoverPopular,
  listDiscoverAlerts,
  createDiscoverAlert,
  deleteDiscoverAlert,
} = require('../controllers/discoverController');

router.get('/popular', discoverLimiter, discoverPopular);
router.get('/', discoverLimiter, discoverSearch);
router.get('/alerts', authenticate, listDiscoverAlerts);
router.post('/alerts', authenticate, createDiscoverAlert);
router.delete('/alerts/:id', authenticate, deleteDiscoverAlert);

module.exports = router;
