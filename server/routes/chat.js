const router = require('express').Router();
const { chatMessage } = require('../controllers/chatController');

// Public — no auth required for support chat
router.post('/message', chatMessage);

module.exports = router;
