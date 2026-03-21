const router = require('express').Router();
const authenticate = require('../middleware/authenticate');
const { getNotifications, markRead, markAllRead, deleteNotification } = require('../controllers/notificationController');

router.get('/', authenticate, getNotifications);
router.put('/:id/read', authenticate, markRead);
router.put('/read-all', authenticate, markAllRead);
router.delete('/:id', authenticate, deleteNotification);

module.exports = router;
