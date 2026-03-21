const router = require('express').Router();
const authenticate = require('../middleware/authenticate');
const { createDispute, getDispute, addMessage, getMyDisputes, resolveDispute } = require('../controllers/disputeController');

router.get('/me', authenticate, getMyDisputes);
router.post('/', authenticate, createDispute);
router.get('/:id', authenticate, getDispute);
router.post('/:id/message', authenticate, addMessage);
router.post('/:id/resolve', authenticate, resolveDispute);

module.exports = router;
