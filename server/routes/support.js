const router  = require('express').Router();
const { authenticate } = require('../middleware/auth');
const ctrl    = require('../controllers/supportController');

// Public — guests and logged-in users can submit
router.post('/request', ctrl.submitSupportRequest);

// Authenticated user — view and reply to their own tickets
router.get('/my-tickets',                      authenticate, ctrl.getMyTickets);
router.get('/my-tickets/:ticketId',            authenticate, ctrl.getMyTicket);
router.post('/my-tickets/:ticketId/reply',     authenticate, ctrl.replyToMyTicket);

module.exports = router;
