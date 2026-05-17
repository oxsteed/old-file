const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const ctrl = require('../controllers/businessWaitlistController');

router.get   ('/:businessId/waitlist',               requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.listWaitlist);
router.post  ('/:businessId/waitlist',               requireAuth,                                                ctrl.addToWaitlist);
router.put   ('/:businessId/waitlist/:entryId',      requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.updateWaitlistEntry);
router.delete('/:businessId/waitlist/:entryId',      requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.removeFromWaitlist);

module.exports = router;
