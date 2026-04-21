const router = require('express').Router();
const { generalLimiter } = require('../middleware/rateLimiter');
const { authenticate } = require('../middleware/auth');
const {
  discoverSearch,
  listDiscoverAlerts,
  createDiscoverAlert,
  deleteDiscoverAlert,
} = require('../controllers/discoverController');

router.get('/', generalLimiter, discoverSearch);
router.get('/alerts', authenticate, listDiscoverAlerts);
router.post('/alerts', authenticate, createDiscoverAlert);
router.delete('/alerts/:id', authenticate, deleteDiscoverAlert);

module.exports = router;
