const router  = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const ctrl    = require('../controllers/supportController');

// Public — guests and logged-in users can submit (rate-limited to prevent spam)
router.post('/request', authLimiter, ctrl.submitSupportRequest);

// Authenticated user — view and reply to their own tickets
router.get('/my-tickets',                      authenticate, ctrl.getMyTickets);
router.get('/my-tickets/:ticketId',            authenticate, ctrl.getMyTicket);
router.post('/my-tickets/:ticketId/reply',     authenticate, ctrl.replyToMyTicket);

module.exports = router;
